; Custom NSIS check that runs before the installer replaces files.
;
; electron-builder's built-in guard (checkAppRunning) looks for processes whose
; image path starts with $INSTDIR. When it does find one it tries to close it,
; and if the close fails it dead-ends in a modal "Iroiroppa cannot be closed"
; loop before anything is installed. That has been observed on the maintainer's
; machine with no Iroiroppa.exe running at all (the guard matched something it
; could not close), and it also blocks an upgrade whenever the running copy is
; not the one under $INSTDIR - a portable run or a build from another folder.
;
; Close the app ourselves instead, by image name. The close is best effort: if a
; copy is owned by another user or elevated, the install continues and NSIS
; reports the locked file at the write step, which names the real problem,
; instead of looping on a dialog that cannot succeed.
!macro customCheckAppRunning
  DetailPrint "Closing a running Iroiroppa..."
  nsExec::ExecToLog `"$SYSDIR\taskkill.exe" /IM "${APP_EXECUTABLE_FILENAME}" /F /T`
  Pop $R0
  Sleep 500
!macroend
