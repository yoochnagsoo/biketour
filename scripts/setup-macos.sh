#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "이 스크립트는 macOS에서 실행해주세요."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 이상이 필요합니다. https://nodejs.org 에서 설치해주세요."
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  echo "현재 Node.js 버전은 $(node --version)입니다. Node.js 22 이상으로 올려주세요."
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode를 App Store에서 설치한 뒤 한 번 실행해주세요."
  exit 1
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

echo "1/3 npm 패키지를 설치합니다."
npm ci

echo "2/3 Next.js 결과물과 iOS 프로젝트를 동기화합니다."
npm run ios:sync

echo "3/3 Xcode 프로젝트를 엽니다."
npx cap open ios

echo "Xcode의 App 타깃 > Signing & Capabilities에서 Personal Team을 선택하세요."
