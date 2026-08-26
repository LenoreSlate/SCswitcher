Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path 'icons' | Out-Null

$sizes = @(16, 48, 128)
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    
    # Background orange SoundCloud
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 85, 0))
    $g.FillEllipse($brush, 0, 0, $size, $size)
    
    # Simple cloud shape in white
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $scale = $size / 32.0
    $g.FillEllipse($whiteBrush, [int](8 * $scale), [int](10 * $scale), [int](10 * $scale), [int](10 * $scale))
    $g.FillEllipse($whiteBrush, [int](14 * $scale), [int](8 * $scale), [int](12 * $scale), [int](12 * $scale))
    $g.FillRectangle($whiteBrush, [int](8 * $scale), [int](15 * $scale), [int](18 * $scale), [int](6 * $scale))
    
    $outPath = "icons/icon$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $brush.Dispose()
    $whiteBrush.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}
Write-Output "Icons generated successfully!"
