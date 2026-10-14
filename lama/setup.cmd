@echo off
chcp 65001 >nul
title MarkingPhotos - ตัวลบวัตถุ (LaMa)
rem ไฟล์นี้มีสองส่วน: ส่วน batch ข้างบนแค่เรียก PowerShell ให้รันส่วนที่อยู่หลังเครื่องหมาย PSSTART
rem (ทำเป็นไฟล์เดียวให้ผู้ใช้ดับเบิลคลิกได้เลย ไม่ต้องตั้ง ExecutionPolicy เอง)
set "MP_SELF=%~f0"
set "MP_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:MP_SELF,[Text.Encoding]::UTF8); $i=$s.IndexOf('#PS'+'START#'); try { iex $s.Substring($i) } catch { Write-Host ''; Write-Host ('  ติดตั้งไม่สำเร็จ: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
set "MP_RC=%ERRORLEVEL%"
echo.
if not "%MP_QUIET%"=="1" pause
exit /b %MP_RC%

#PSSTART#
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$Base    = 'https://markingphotos.pages.dev/lama'
# โฟลเดอร์ต้องชื่อสั้น — ไฟล์ข้างใน PyTorch ลึกมาก ถ้า path ยาวเกิน 260 ตัวอักษร Windows จะติดตั้งไม่ผ่าน
$Dir     = if ($env:MP_LAMA_DIR) { $env:MP_LAMA_DIR } else { Join-Path $env:LOCALAPPDATA 'MPLama' }
$Port    = if ($env:MP_LAMA_PORT) { [int]$env:MP_LAMA_PORT } else { 5188 }
$PyVer   = '3.12.10'
$Startup = [Environment]::GetFolderPath('Startup')
$Lnk     = Join-Path $Startup 'MarkingPhotos LaMa.lnk'
$Uninst  = "$env:MP_ARGS" -match 'uninstall'

function Say([string]$t, [string]$c = 'Gray') { Write-Host "  $t" -ForegroundColor $c }
function Step([string]$t) { Write-Host ''; Write-Host "  ▶ $t" -ForegroundColor Cyan }

function Health {
    try { return Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2 } catch { return $null }
}

function Stop-Helper {
    Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Dir*lama_helper.py*" } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
}

function Fetch([string]$url, [string]$dest) {
    $tmp = "$dest.part"
    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (Test-Path $curl) {
        & $curl -fL --retry 3 --progress-bar -o $tmp $url
        if ($LASTEXITCODE -ne 0) { throw "ดาวน์โหลดไม่สำเร็จ: $url" }
    } else {
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
    }
    Move-Item -Force $tmp $dest
}

# Python ตัวที่ใช้ได้ต้อง import torch + cv2 + numpy ได้ครบ
function Test-Py([string]$exe) {
    # PowerShell 5.1 แปลง stderr ของโปรแกรมเป็น error — ถ้าปล่อยเป็น Stop คำเตือนเล็ก ๆ จาก torch จะทำให้ตกทดสอบ
    $ErrorActionPreference = 'Continue'
    if (-not $exe -or -not (Test-Path $exe)) { return $false }
    if ($exe -like '*\WindowsApps\*') { return $false }       # ตัวหลอกของ Microsoft Store
    try {
        $out = & $exe -c "import sys; import torch, cv2, numpy; print('PYOK', sys.version_info[0], sys.version_info[1])" 2>$null
        return [bool]($out -match 'PYOK')
    } catch { return $false }
}

Write-Host ''
Write-Host '  ตัวลบวัตถุ (LaMa) สำหรับเว็บป้ายเลขที่งาน' -ForegroundColor White
Write-Host '  ------------------------------------------'
Say "ติดตั้งไว้ที่ $Dir"

# ───────────── ถอนการติดตั้ง ─────────────
if ($Uninst) {
    Step 'ถอนการติดตั้ง'
    Stop-Helper
    Start-Sleep -Milliseconds 800
    if (Test-Path $Lnk) { Remove-Item -Force $Lnk }
    if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
    Say 'ลบเรียบร้อย' Green
    exit 0
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# ───────────── 1. ไฟล์ตัวช่วย ─────────────
Step '1/5 ไฟล์ตัวช่วย'
$here = Split-Path -Parent $env:MP_SELF
$local = Join-Path $here 'lama_helper.py'
$helper = Join-Path $Dir 'lama_helper.py'
if ((Test-Path $local) -and ((Resolve-Path $local).Path -ne $helper)) {
    Copy-Item -Force $local $helper
    Say 'ใช้ไฟล์ที่อยู่ข้างตัวติดตั้ง'
} else {
    Fetch "$Base/lama_helper.py?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" $helper
    Say 'ดาวน์โหลดจากเว็บแล้ว'
}

# ───────────── 2. Python + torch ─────────────
Step '2/5 Python และ PyTorch'
$py = $null
$private = Join-Path $Dir 'python\python.exe'
$cands = @()
if (Test-Path $private) { $cands += $private }
if ($env:MP_FORCE_PRIVATE -ne '1') {
    $cands += @(Get-Command python -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    $ErrorActionPreference = 'Continue'
    try { $cands += (& py -3 -c "import sys; print(sys.executable)" 2>$null) } catch {}
    $ErrorActionPreference = 'Stop'
}
foreach ($c in ($cands | Where-Object { $_ } | Select-Object -Unique)) {
    if (Test-Py $c) { $py = $c; break }
}

if ($py) {
    Say "ใช้ Python ที่มีอยู่แล้ว: $py" Green
} else {
    # Python แบบพกพา (embeddable) แยกไว้ในโฟลเดอร์นี้ ไม่ยุ่งกับ Python ที่เครื่องมีอยู่ และไม่ต้องใช้สิทธิ์แอดมิน
    $pyDir = Join-Path $Dir 'python'
    if (-not (Test-Path $private)) {
        Say "ดาวน์โหลด Python $PyVer (ประมาณ 10 MB)"
        $zip = Join-Path $Dir 'python.zip'
        Fetch "https://www.python.org/ftp/python/$PyVer/python-$PyVer-embed-amd64.zip" $zip
        Expand-Archive -Force $zip $pyDir
        Remove-Item -Force $zip
        $pth = Get-ChildItem $pyDir -Filter 'python*._pth' | Select-Object -First 1
        $tag = [IO.Path]::GetFileNameWithoutExtension($pth.Name)
        Set-Content -Encoding ASCII -Path $pth.FullName -Value @("$tag.zip", '.', 'Lib\site-packages', 'import site')
    }
    if (-not (Test-Path (Join-Path $pyDir 'Lib\site-packages\pip'))) {
        Say 'ติดตั้ง pip'
        $gp = Join-Path $Dir 'get-pip.py'
        Fetch 'https://bootstrap.pypa.io/get-pip.py' $gp
        & $private $gp --no-warn-script-location -q
        if ($LASTEXITCODE -ne 0) { throw 'ติดตั้ง pip ไม่สำเร็จ' }
        Remove-Item -Force $gp
    }
    Say 'ติดตั้ง PyTorch (ประมาณ 200 MB รอสักครู่)'
    & $private -m pip install --no-warn-script-location --disable-pip-version-check torch --index-url https://download.pytorch.org/whl/cpu
    if ($LASTEXITCODE -ne 0) { throw 'ติดตั้ง PyTorch ไม่สำเร็จ' }
    Say 'ติดตั้ง OpenCV + NumPy'
    & $private -m pip install --no-warn-script-location --disable-pip-version-check numpy opencv-python-headless
    if ($LASTEXITCODE -ne 0) { throw 'ติดตั้ง OpenCV ไม่สำเร็จ' }

    if (-not (Test-Py $private)) {
        # torch บน Windows ต้องมี Visual C++ Runtime — เครื่องส่วนใหญ่มีแล้ว ถ้าไม่มีต้องลงเพิ่ม (Windows จะถามสิทธิ์)
        Say 'ติดตั้ง Microsoft Visual C++ Runtime (Windows อาจถามสิทธิ์ ให้กด Yes)' Yellow
        $vc = Join-Path $Dir 'vc_redist.x64.exe'
        Fetch 'https://aka.ms/vs/17/release/vc_redist.x64.exe' $vc
        Start-Process -Wait $vc -ArgumentList '/install', '/quiet', '/norestart'
        Remove-Item -Force $vc
    }
    if (-not (Test-Py $private)) { throw 'Python ที่ติดตั้งยัง import torch ไม่ได้' }
    $py = $private
    Say 'พร้อม' Green
}
$pyw = Join-Path (Split-Path -Parent $py) 'pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = $py }
Set-Content -Encoding UTF8 -Path (Join-Path $Dir 'python-path.txt') -Value $py

# ───────────── 3. โมเดล LaMa ─────────────
Step '3/5 โมเดล LaMa (ประมาณ 200 MB ครั้งแรกครั้งเดียว)'
& $py $helper --download
if ($LASTEXITCODE -ne 0) { throw 'โหลดโมเดลไม่สำเร็จ' }

# ───────────── 4. ทดสอบ ─────────────
Step '4/5 ทดสอบลบวัตถุ'
& $py $helper --check
if ($LASTEXITCODE -ne 0) { throw 'ทดสอบไม่ผ่าน' }

# ───────────── 5. ให้เปิดเองทุกครั้งที่เข้า Windows + เปิดเลยตอนนี้ ─────────────
Step '5/5 ตั้งให้เปิดอัตโนมัติ'
if ($env:MP_NO_STARTUP -ne '1') {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($Lnk)
    $sc.TargetPath = $pyw
    $sc.Arguments = "`"$helper`""
    $sc.WorkingDirectory = $Dir
    $sc.WindowStyle = 7
    $sc.Description = 'MarkingPhotos - ตัวลบวัตถุ (LaMa)'
    $sc.Save()
    Say 'เปิดเองทุกครั้งที่เข้า Windows'
}
$un = Join-Path $Dir 'ถอนการติดตั้ง.cmd'
Copy-Item -Force $env:MP_SELF (Join-Path $Dir 'setup.cmd')
# ก็อปตัวติดตั้งไป TEMP ก่อน เพราะการถอนจะลบโฟลเดอร์นี้ทิ้งทั้งที่ไฟล์ยังรันอยู่
Set-Content -Encoding ASCII -Path $un -Value "@echo off`r`ncopy /y `"%~dp0setup.cmd`" `"%TEMP%\mp-lama-uninstall.cmd`" >nul & `"%TEMP%\mp-lama-uninstall.cmd`" uninstall"

$h = Health
if ($h -and $h.version) {
    # มีตัวเก่าเปิดค้างอยู่ ปิดแล้วเปิดใหม่ให้ได้ไฟล์ล่าสุด
    Stop-Helper
    Start-Sleep -Seconds 1
}
Start-Process -FilePath $pyw -ArgumentList "`"$helper`"" -WorkingDirectory $Dir -WindowStyle Hidden
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    $h = Health
    if ($h -and $h.ai -eq 'ready') { $ok = $true; break }
}
Write-Host ''
if ($ok) {
    Say 'ติดตั้งเสร็จแล้ว ✔' Green
    Say 'กลับไปที่หน้าเว็บ แล้วกดปุ่ม "ลบวัตถุ" ได้เลย (หน้าเว็บจะรู้เองภายในไม่กี่วินาที)'
    exit 0
}
Say 'ติดตั้งแล้ว แต่ตัวช่วยยังไม่ตอบ — ลองเปิดไฟล์นี้อีกครั้ง หรือดู helper.log ในโฟลเดอร์ติดตั้ง' Yellow
exit 1
