; Pemasang Dragon Dynamic Island untuk Windows 64-bit (dibuat dengan NSIS, kompresi LZMA).
; Dipasang per pengguna (tanpa hak administrator) ke %LOCALAPPDATA%\Programs\Dragon Dynamic Island.
; Dipanggil oleh scripts/build-win.sh dengan /DVERSION=... /DSRC=... /DOUT=... /DICON=...

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!define NAME "Dragon Dynamic Island"
!define EXE "Dragon Dynamic Island.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DragonDynamicIsland"

Name "${NAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${NAME}"
RequestExecutionLevel user
Icon "${ICON}"
UninstallIcon "${ICON}"
BrandingText "${NAME} ${VERSION}"

!include "MUI2.nsh"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Jalankan ${NAME}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Indonesian"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_INDONESIAN} "ProductName" "${NAME}"
VIAddVersionKey /LANG=${LANG_INDONESIAN} "FileDescription" "Pemasang ${NAME}"
VIAddVersionKey /LANG=${LANG_INDONESIAN} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_INDONESIAN} "ProductVersion" "${VERSION}"

Section "Pasang"
  ; Tutup aplikasi yang sedang berjalan supaya berkasnya bisa diganti.
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Sleep 800
  ; Versi lama di folder ini dihapus dulu (data pengguna ada di AppData\Roaming, tidak tersentuh).
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortCut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Sleep 800
  ; Hapus "jalankan saat Windows menyala" bila menunjuk ke aplikasi ini.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.${NAME}"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  ; Data (shelf, todo, notes, pengaturan) di AppData\Roaming\Dragon Dynamic Island sengaja dibiarkan.
SectionEnd
