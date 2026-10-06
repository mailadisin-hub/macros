# Run this ON THE ALIENWARE (ufo-2). Starts a local vision model the Macros app can call over Tailscale.
#   powershell -ExecutionPolicy Bypass -File start-vision.ps1
# First run downloads ~5.8 GB. Stop Jouska's llama-server first: both won't fit in 8 GB VRAM together.

$ErrorActionPreference = 'Stop'
$llama  = 'C:\llm\llama.cpp'
$models = 'C:\llm\models\qwen3-vl-8b'
$port   = 8081
$base   = 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main'
$files  = @('Qwen3VL-8B-Instruct-Q4_K_M.gguf', 'mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf')

New-Item -ItemType Directory -Force $models | Out-Null
foreach ($f in $files) {
  $dest = Join-Path $models $f
  if (-not (Test-Path $dest)) {
    Write-Host "Downloading $f ..."
    curl.exe -L --fail -C - -o "$dest.part" "$base/$f"
    Move-Item "$dest.part" $dest
  }
}

$server = Get-ChildItem $llama -Recurse -Filter 'llama-server.exe' | Select-Object -First 1
if (-not $server) { throw "llama-server.exe not found under $llama" }

# HTTPS for the phone: the app is served over https, so it can only call an https address.
# Needs MagicDNS + HTTPS Certificates turned on at login.tailscale.com/admin/dns (one-time).
tailscale serve --bg --https=443 "http://127.0.0.1:$port"
$name = (tailscale status --json | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
Write-Host ""
Write-Host "In the Macros app: Settings -> Provider: Other (OpenAI-compatible)"
Write-Host "  Base URL: https://$name/v1"
Write-Host "  Key: leave empty    Model: leave empty"
Write-Host ""

& $server.FullName `
  -m (Join-Path $models $files[0]) `
  --mmproj (Join-Path $models $files[1]) `
  -ngl 99 -c 8192 --jinja `
  --host 127.0.0.1 --port $port
