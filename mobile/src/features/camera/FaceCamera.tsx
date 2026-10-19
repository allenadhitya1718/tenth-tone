import { Component, type ReactNode } from 'react';
import { useAsyncRunner } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';

import FilteredCamera, { type FilteredProps } from './FilteredCamera';

// FilteredCamera plus the ML Kit face detector. Loaded lazily by CameraScreen
// only when the detector module exists in this binary. If creating the
// detector throws, the boundary reports it and CameraScreen falls back to
// FilteredCamera without faces (looks only), never to a black screen.

const OPTIONS = {
  performanceMode: 'fast',
  runLandmarks: true,
  runContours: false,
  runClassifications: false,
  trackingEnabled: false,
  minFaceSize: 0.2,
  autoMode: false,
} as const;

function Host(props: FilteredProps) {
  const detector = useFaceDetector(OPTIONS);
  const runner = useAsyncRunner();
  return <FilteredCamera {...props} detector={detector} runner={runner} />;
}

type BoundaryProps = { onFail: () => void; children: ReactNode };
class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.warn('face camera failed:', error.message);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function FaceCamera(props: FilteredProps) {
  return (
    <Boundary onFail={() => props.onFaceFail?.()}>
      <Host {...props} />
    </Boundary>
  );
}
