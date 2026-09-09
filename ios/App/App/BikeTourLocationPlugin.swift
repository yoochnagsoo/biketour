import UIKit
import CoreLocation
import Capacitor

@objc(BikeTourLocationPlugin)
final class BikeTourLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    let identifier = "BikeTourLocationPlugin"
    let jsName = "BikeTourLocation"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainLocations", returnType: CAPPluginReturnPromise)
    ]

    private let locationManager = CLLocationManager()
    private var pendingStartCall: CAPPluginCall?
    private var shouldStartAfterAuthorization = false
    private var bufferWhileInactive = false
    private let trackingKey = "BikeTourLocation.isTracking"
    private let pausedKey = "BikeTourLocation.isPaused"

    private var bufferURL: URL {
        let directory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory.appendingPathComponent("biketour-location-buffer.jsonl")
    }

    override func load() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 2
        locationManager.activityType = .fitness
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.clearBuffer()
            self.pendingStartCall = call
            self.shouldStartAfterAuthorization = true
            self.handleAuthorizationForStart()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.locationManager.stopUpdatingLocation()
            UserDefaults.standard.set(false, forKey: self.trackingKey)
            UserDefaults.standard.set(true, forKey: self.pausedKey)
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.isAuthorized else {
                call.reject("위치 권한이 필요합니다.")
                return
            }
            self.beginUpdates()
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.locationManager.stopUpdatingLocation()
            UserDefaults.standard.set(false, forKey: self.trackingKey)
            UserDefaults.standard.set(false, forKey: self.pausedKey)
            self.bufferWhileInactive = false
            call.resolve()
        }
    }

    @objc func drainLocations(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let locations = self.readBuffer()
            self.clearBuffer()
            self.bufferWhileInactive = false
            call.resolve(["locations": locations])
        }
    }

    private var isAuthorized: Bool {
        let status = locationManager.authorizationStatus
        return status == .authorizedWhenInUse || status == .authorizedAlways
    }

    private func handleAuthorizationForStart() {
        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            beginUpdates()
            pendingStartCall?.resolve()
            pendingStartCall = nil
            shouldStartAfterAuthorization = false
        case .denied, .restricted:
            pendingStartCall?.reject("위치 권한이 거부되었습니다. iPhone 설정에서 위치 접근을 허용해주세요.")
            pendingStartCall = nil
            shouldStartAfterAuthorization = false
        @unknown default:
            pendingStartCall?.reject("위치 권한 상태를 확인할 수 없습니다.")
            pendingStartCall = nil
            shouldStartAfterAuthorization = false
        }
    }

    private func beginUpdates() {
        bufferWhileInactive = UIApplication.shared.applicationState != .active
        UserDefaults.standard.set(true, forKey: trackingKey)
        UserDefaults.standard.set(false, forKey: pausedKey)
        locationManager.startUpdatingLocation()
    }

    @objc private func appDidEnterBackground() {
        if UserDefaults.standard.bool(forKey: trackingKey) {
            bufferWhileInactive = true
        }
    }

    @objc private func appWillEnterForeground() {
        // Keep buffering until JavaScript drains the queued points. This preserves
        // ordering if a new location arrives while the WebView is waking up.
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard shouldStartAfterAuthorization else { return }
        handleAuthorizationForStart()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 {
            let payload: [String: Any] = [
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "speed": location.speed >= 0 ? location.speed : NSNull(),
                "timestamp": location.timestamp.timeIntervalSince1970 * 1000
            ]

            if bufferWhileInactive || UIApplication.shared.applicationState != .active {
                appendToBuffer(payload)
            } else {
                notifyListeners("location", data: payload)
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        notifyListeners("locationError", data: ["message": error.localizedDescription])
    }

    private func appendToBuffer(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              var line = String(data: data, encoding: .utf8) else { return }
        line.append("\n")
        guard let lineData = line.data(using: .utf8) else { return }

        if !FileManager.default.fileExists(atPath: bufferURL.path) {
            FileManager.default.createFile(atPath: bufferURL.path, contents: nil)
        }
        guard let handle = try? FileHandle(forWritingTo: bufferURL) else { return }
        defer { try? handle.close() }
        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: lineData)
        } catch {
            return
        }
    }

    private func readBuffer() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: bufferURL),
              let content = String(data: data, encoding: .utf8) else { return [] }

        return content.split(separator: "\n").compactMap { line in
            guard let lineData = String(line).data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: lineData),
                  let payload = object as? [String: Any] else { return nil }
            return payload
        }
    }

    private func clearBuffer() {
        try? FileManager.default.removeItem(at: bufferURL)
    }
}

final class BikeTourViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(BikeTourLocationPlugin())
    }
}
