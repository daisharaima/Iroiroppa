'use strict';

// Command names and wire enums for the CSP Companion Mode protocol.
// Command names are the exact strings carried in the "$command=" field.

const COMMANDS = Object.freeze({
  Authenticate: 'Authenticate',
  TellHeartbeat: 'TellHeartbeat',
  PreNotifyOfServerShutdown: 'PreNotifyOfServerShutdown',
  GetServerSelectedTabKind: 'GetServerSelectedTabKind',
  SetServerSelectedTabKind: 'SetServerSelectedTabKind',
  GetModifyKeyString: 'GetModifyKeyString',
  DoModeChange: 'DoModeChange',
  SetCurrentColor: 'SetCurrentColor',
  SetColorSelectionModel: 'SetColorSelectionModel',
  SetBrushSize: 'SetBrushSize',
  SetAlpha: 'SetAlpha',
  DoGesture: 'DoGesture',
  DoNavigator: 'DoNavigator',
  GetQuickAccessData: 'GetQuickAccessData',
  GetQuickAccessItemIcon: 'GetQuickAccessItemIcon',
  DoQuickAccess: 'DoQuickAccess',
  PreviewWebtoonFromClient: 'PreviewWebtoonFromClient',
  PreviewWebtoonFromServer: 'PreviewWebtoonFromServer',
  SyncQuickAccessUIState: 'SyncQuickAccessUIState',
  SyncColorCircleUIState: 'SyncColorCircleUIState',
  SyncColorMixUIState: 'SyncColorMixUIState',
  SyncGesturePadUIState: 'SyncGesturePadUIState',
  SyncSubViewUIState: 'SyncSubViewUIState',
  SyncSettingUIState: 'SyncSettingUIState',
});

// Host-initiated commands we may receive and must ACK.
const SERVER_INITIATED = new Set([
  COMMANDS.PreNotifyOfServerShutdown,
  COMMANDS.SyncQuickAccessUIState,
  COMMANDS.SyncColorCircleUIState,
  COMMANDS.SyncColorMixUIState,
  COMMANDS.SyncGesturePadUIState,
  COMMANDS.SyncSubViewUIState,
  COMMANDS.SyncSettingUIState,
  COMMANDS.PreviewWebtoonFromServer,
]);

// Auth failure reasons. "" and "Unknown" both mean success.
const AUTH_FAILURES = new Set(['VersionMismatch', 'PasswordMismatch', 'ServerUnready']);

// Color space discriminator used by SetCurrentColor / Sync* replies.
const COLOR_SPACE = Object.freeze({ UNKNOWN: 'Unknown', HSV: 'HSV', HLS: 'HLS' });

// uint32 channel scaling used by the Sync* color payloads.
const MAX_U32 = 4294967295;

module.exports = { COMMANDS, SERVER_INITIATED, AUTH_FAILURES, COLOR_SPACE, MAX_U32 };
