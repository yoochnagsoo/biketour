import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeLocationPoint = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  timestamp: number;
};

type NativeLocationPlugin = {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  drainLocations(): Promise<{ locations: NativeLocationPoint[] }>;
  addListener(
    eventName: "location",
    listener: (point: NativeLocationPoint) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "locationError",
    listener: (error: { message: string }) => void,
  ): Promise<PluginListenerHandle>;
};

export const NativeRideLocation = registerPlugin<NativeLocationPlugin>(
  "BikeTourLocation",
);
