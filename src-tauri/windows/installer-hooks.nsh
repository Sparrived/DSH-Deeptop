!macro NSIS_HOOK_POSTINSTALL
  ; Materialize and verify the bundled DSH runtime before the installer exits.
  ; The helper does not start DSH and returns a non-zero code on any failure.
  DetailPrint "正在准备内嵌 DSH 运行时，首次安装可能需要几分钟..."
  nsExec::ExecToLog /TIMEOUT=900000 '"$INSTDIR\${MAINBINARYNAME}.exe" --prepare-bundled-runtime'
  Pop $0
  ${If} $0 != "0"
    MessageBox MB_ICONSTOP|MB_OK "内嵌 DSH 运行时准备失败（返回码：$0）。安装未完成，请重试。"
    Abort
  ${EndIf}
  DetailPrint "内嵌 DSH 运行时准备完成。"
!macroend
