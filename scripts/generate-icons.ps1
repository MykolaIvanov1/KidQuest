Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot '../frontend/public/icons'
foreach ($size in @(192, 512)) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 512.0, $size / 512.0)
  $background = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#29634c'))
  $face = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#d6f3bc'))
  $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#f5cf70'))
  $eyes = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#183b2b'))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#183b2b')), 16
  $graphics.FillRectangle($background, 0, 0, 512, 512)
  $graphics.FillRectangle($face, 116, 190, 280, 150)
  $graphics.FillEllipse($face, 116, 150, 280, 240)
  $graphics.FillRectangle($face, 245, 112, 22, 65)
  $graphics.FillEllipse($accent, 234, 88, 44, 44)
  $graphics.FillRectangle($accent, 83, 235, 28, 72)
  $graphics.FillRectangle($accent, 401, 235, 28, 72)
  $graphics.FillEllipse($eyes, 179, 229, 44, 44)
  $graphics.FillEllipse($eyes, 289, 229, 44, 44)
  $graphics.DrawArc($pen, 210, 283, 92, 58, 0, 180)
  $bitmap.Save((Join-Path $iconDirectory "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose()
  $eyes.Dispose()
  $accent.Dispose()
  $face.Dispose()
  $background.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
