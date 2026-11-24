# Binari esterni

**Non serve fare nulla a mano:** al primo avvio, se adb o scrcpy mancano, DanfixMate li scarica
da solo dalle fonti ufficiali (Google e GitHub/Genymobile) in `%APPDATA%\DanfixMate\bin`.

Questa cartella serve solo se vuoi includere versioni specifiche nell'installer
(`extraResources`): i binari messi qui hanno la precedenza su quelli scaricati e su quelli nel PATH.
Ordine di ricerca: `resources/bin` → `%APPDATA%\DanfixMate\bin` → Android SDK → PATH.

```
resources/bin/
├─ platform-tools/        ← adb.exe, AdbWinApi.dll, AdbWinUsbApi.dll, fastboot.exe
├─ scrcpy/                ← scrcpy.exe e le sue DLL (puoi anche usare l'adb incluso qui)
└─ libimobiledevice/      ← idevice_id.exe, ideviceinfo.exe, … (sperimentale)
```

- **platform-tools**: https://developer.android.com/tools/releases/platform-tools (Windows zip)
- **scrcpy**: https://github.com/Genymobile/scrcpy/releases (`scrcpy-win64-vX.Y.zip`)
- **libimobiledevice per Windows**: build precompilate, es. https://github.com/libimobiledevice-win32/imobiledevice-net/releases
  Serve anche il driver *Apple Mobile Device Support* (si installa con l'app Apple Devices / iTunes).

Driver USB Android: per molti Samsung/Xiaomi serve il driver del produttore (o il Google USB Driver)
perché il telefono compaia in `adb devices`.
