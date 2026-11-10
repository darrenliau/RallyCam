import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { CourtMap } from '../analysis/court';
import type { Track } from '../analysis/players';
import type { ShuttleOnMap, ShuttleStats } from '../analysis/shuttle';
import type { MatchState } from '../engine/types';
import { SHUTTLE_COLOR, shuttleLabelText } from '../export/ass';
import { PlayerOverlay, type TagInfo } from './PlayerOverlay';
import { ViewWindow, type ViewWindowHandle } from './ViewWindow';
import { applyViewTransform, type ViewTransform } from '../analysis/framing';
import type { Ref } from 'react';
import { ScoreBoard } from './ScoreBoard';
import { CourtMapCard, DistanceCard, ShuttleCards } from './StatCards';

export interface Insets { l: number; r: number; t: number; b: number }

/**
 * Everything drawn over the camera: score, player rings and tags, court map, distance, shuttle speed and shots.
 * The Record screen draws it live, and the Review screen draws it again over the saved video from stored data.
 */
export function MatchOverlay({
  width, height, inset, map, tracks, tagFor, selected = null, onTagPress, state, distanceRows, shuttle,
  scoreOnly = false, mapTop = 8, hideEmptyShuttle = false, trail, shuttleMap, worldRef, worldView,
}: {
  width: number; height: number; inset: Insets; map: CourtMap; tracks: Track[]; tagFor: (id: number) => TagInfo;
  selected?: number | null; onTagPress?: (id: number) => void; state: MatchState;
  distanceRows: { name: string; color: string; metres: number | null }[]; shuttle: ShuttleStats | null;
  /** While the court is being aligned only the scoreboard is shown. */
  scoreOnly?: boolean;
  /** Distance from the top for the court map, so the Record screen can leave room for its status chips. */
  mapTop?: number;
  /** Leave out the shuttle cards while there is no shuttle data. */
  hideEmptyShuttle?: boolean;
  /** The shuttle's recent path in canvas pixels, oldest first. */
  trail?: { x: number; y: number }[];
  /** The shuttle on the court map. */
  shuttleMap?: ShuttleOnMap | null;
  /**
   * Auto-framing: the player rings and the shuttle trail are things of the picture, so they move with the zoom (they are put in a view
   * window that `worldRef` drives); the score, court map and cards stay where they are. `worldView` is where the window is now, to place the shuttle's label.
   */
  worldRef?: Ref<ViewWindowHandle>;
  worldView?: ViewTransform | null;
}) {
  const boardW = Math.min(360, width - 2 * (inset.l + 170));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <ViewWindow ref={worldRef}>
      {!scoreOnly && (
        <PlayerOverlay map={map} width={width} height={height} tracks={tracks} tagFor={tagFor} selected={selected} onTagPress={onTagPress ?? (() => {})} />
      )}
      {trail && trail.length > 0 && (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {trail.map((p, i) => {
            const age = (i + 1) / trail.length;
            return <Circle key={i} cx={p.x} cy={p.y} r={2 + 4 * age} fill={SHUTTLE_COLOR} opacity={0.25 + 0.7 * age} />;
          })}
          <Circle cx={trail[trail.length - 1].x} cy={trail[trail.length - 1].y} r={11} fill="none" stroke={SHUTTLE_COLOR} strokeWidth={2.5} />
        </Svg>
      )}
      </ViewWindow>
      {trail && trail.length > 0 && (() => {
        const p = worldView ? applyViewTransform(trail[trail.length - 1], worldView, { frameAspect: 16 / 9, screenW: width, screenH: height }) : trail[trail.length - 1];
        const text = shuttleLabelText(shuttle?.speedKmh);
        const w = text.length * 6.6 + 18;
        const x = Math.min(Math.max(p.x - w / 2, 4), width - w - 4);
        const y = p.y - 11 - 22 - 6 >= 4 ? p.y - 11 - 22 - 6 : p.y + 11 + 6;
        return (
          <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width: w, height: 22, borderRadius: 6, backgroundColor: 'rgba(11,18,16,0.85)', borderLeftWidth: 4, borderLeftColor: SHUTTLE_COLOR, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{text}</Text>
          </View>
        );
      })()}
      <View style={{ position: 'absolute', top: inset.t, left: (width - boardW) / 2, width: boardW }} pointerEvents="none">
        {!state.config.training && <ScoreBoard state={state} />}
      </View>
      {!scoreOnly && (
        <>
          {(shuttle || !hideEmptyShuttle) && (
            <View style={{ position: 'absolute', top: inset.t, right: inset.r }} pointerEvents="none">
              <ShuttleCards stats={shuttle} />
            </View>
          )}
          <View style={{ position: 'absolute', left: inset.l, top: mapTop }} pointerEvents="none">
            <CourtMapCard tracks={tracks} tagFor={tagFor} shuttle={shuttleMap} />
          </View>
          <View style={{ position: 'absolute', left: inset.l, bottom: inset.b }} pointerEvents="none">
            <DistanceCard rows={distanceRows} />
          </View>
        </>
      )}
    </View>
  );
}
