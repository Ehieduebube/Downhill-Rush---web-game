# Downscales the Quaternius 2K source textures for the web build.
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File tools/skater/resize-textures.ps1
# Uses System.Drawing, which ships with Windows - no extra tools needed.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot '..\..\assets-src\quaternius\textures-2k'
$dst = Join-Path $PSScriptRoot '..\..\assets-src\quaternius\textures-web'
New-Item -ItemType Directory -Force -Path $dst | Out-Null

function Save-Resized([string]$name, [string]$outName, [int]$size, [string]$format, [int]$quality) {
  $inPath = Join-Path $src $name
  $outPath = Join-Path $dst $outName
  $img = [System.Drawing.Image]::FromFile((Resolve-Path $inPath))
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $size, $size)
  if ($format -eq 'jpg') {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $params = New-Object System.Drawing.Imaging.EncoderParameters 1
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$quality)
    $bmp.Save($outPath, $codec, $params)
  } else {
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  Write-Output ("{0} -> {1} ({2} KB)" -f $name, $outName, [math]::Round((Get-Item $outPath).Length / 1KB))
}

Save-Resized 'T_Superhero_Male_Dark.png' 'skin_color.jpg' 1024 'jpg' 90
Save-Resized 'T_Superhero_Male_Normal.png' 'skin_normal.jpg' 1024 'jpg' 94
Save-Resized 'T_Eye_Brown.png' 'eye_color.jpg' 256 'jpg' 90
Save-Resized 'T_Hair_1_BaseColor.png' 'hair_color.jpg' 512 'jpg' 90
Save-Resized 'T_Hair_1_Normal.png' 'hair_normal.jpg' 512 'jpg' 92
