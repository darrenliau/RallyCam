import Constants, { ExecutionEnvironment } from 'expo-constants';
import { forwardRef, type ComponentType } from 'react';
import { Platform } from 'react-native';
import { Capture } from '../../modules/rallycam-export/src/capture';
import type { RecorderHandle, RecorderProps } from './types';

/** True when running inside Expo Go, which only contains Expo's own native modules. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Set to false to use vision-camera on iPhone too. The native camera draws the overlay into the video while recording,
 * so the saved video is finished when the game ends.
 */
const PREFER_NATIVE_CAPTURE = true;

/** True on an iPhone build that includes the native camera module. */
export const usesNativeCapture = PREFER_NATIVE_CAPTURE && !isExpoGo && Platform.OS === 'ios' && Capture != null;

// Loaded lazily so Expo Go never tries to load native modules it does not have.
const Impl = (
  isExpoGo
    ? require('./ExpoGoRecorder').default
    : usesNativeCapture
      ? require('./NativeCaptureRecorder').default
      : require('./VisionRecorder').default
) as ComponentType<RecorderProps & { ref?: React.Ref<RecorderHandle> }>;

export const RecorderView = forwardRef<RecorderHandle, RecorderProps>((props, ref) => <Impl {...props} ref={ref} />);
RecorderView.displayName = 'RecorderView';
