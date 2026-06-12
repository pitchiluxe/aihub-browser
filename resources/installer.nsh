; AIHub Browser — Custom NSIS installer script
; Erick OMARI — My Digital Solutions

!macro customInstall
  DetailPrint "AIHub Browser installed successfully."
  DetailPrint "Launch AIHub Browser from your desktop or Start Menu."
!macroend

!macro customUninstall
  DetailPrint "AIHub Browser uninstalled. Your data in %USERPROFILE%\.aihub-browser is preserved."
!macroend
