; AIHub Browser — Custom NSIS installer script
; Erick OMARI — My Digital Solutions

; Defining customCheckAppRunning suppresses these defaults in electron-builder.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${If} ${isUpdated}
    ; Electron starts the installer before it finishes shutting down. Give the
    ; browser and its child processes time to release the installation files.
    StrCpy $R1 0
    aihub_wait_for_update_exit:
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${If} $R0 == 0
        IntOp $R1 $R1 + 1
        ${If} $R1 < 12
          Sleep 1000
          Goto aihub_wait_for_update_exit
        ${EndIf}
      ${EndIf}
  ${EndIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend

!macro customInstall
  DetailPrint "AIHub Browser installed successfully."
  DetailPrint "Launch AIHub Browser from your desktop or Start Menu."
!macroend

!macro customUninstall
  DetailPrint "AIHub Browser uninstalled. Your data in %USERPROFILE%\.aihub-browser is preserved."
!macroend
