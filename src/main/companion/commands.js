'use strict';

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

const AUTH_FAILURES = new Set(['VersionMismatch', 'PasswordMismatch', 'ServerUnready']);

const COLOR_SPACE = Object.freeze({ UNKNOWN: 'Unknown', HSV: 'HSV', HLS: 'HLS' });

const MAX_U32 = 4294967295;

module.exports = { COMMANDS, SERVER_INITIATED, AUTH_FAILURES, COLOR_SPACE, MAX_U32 };
