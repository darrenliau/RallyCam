import Constants, { ExecutionEnvironment } from 'expo-constants';
import { forwardRef, type ComponentType } from 'react';
import type { RecorderHandle, RecorderProps } from './types';

/** True when running inside Expo Go, which only contains Expo's own native modules. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Loaded lazily so Expo Go never tries to load the vision-camera native module.
const Impl = (isExpoGo ? require('./ExpoGoRecorder').default : require('./VisionRecorder').default) as ComponentType<RecorderProps & { ref?: React.Ref<RecorderHandle> }>;

export const RecorderView = forwardRef<RecorderHandle, RecorderProps>((props, ref) => <Impl {...props} ref={ref} />);
RecorderView.displayName = 'RecorderView';
