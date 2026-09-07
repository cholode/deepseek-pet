; Compile the installer and uninstaller together; no generated executable runs at build time.
!include "MUI2.nsh"
Unicode true
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\DeepBlue Desktop Pet"
Name "DeepBlue 桌宠"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\DeepBlue Desktop Pet.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 DeepBlue 桌宠"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "DeepBlue"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${PROJECT_DIR}\release\win-unpacked\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\DeepBlue 桌宠.lnk" "$INSTDIR\DeepBlue Desktop Pet.exe"
  CreateShortcut "$SMPROGRAMS\DeepBlue 桌宠.lnk" "$INSTDIR\DeepBlue Desktop Pet.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepBlueDesktopPet" "DisplayName" "DeepBlue 桌宠"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepBlueDesktopPet" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepBlueDesktopPet" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepBlueDesktopPet" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepBlueDesktopPet" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepBlueDesktopPet" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ; A moved uninstaller must never recursively remove its new parent folder.
  StrCmp "$INSTDIR" "$LOCALAPPDATA\Programs\DeepBlue Desktop Pet" 0 refuse
  IfFileExists "$INSTDIR\resources\app.asar" 0 refuse
  Delete "$DESKTOP\DeepBlue 桌宠.lnk"
  Delete "$SMPROGRAMS\DeepBlue 桌宠.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepBlueDesktopPet"
  RMDir /r "$INSTDIR"
  Goto done
  refuse:
  MessageBox MB_OK "卸载路径校验失败，请从原安装目录运行卸载程序。"
  done:
SectionEnd
