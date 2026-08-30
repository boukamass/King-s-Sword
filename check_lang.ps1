$path = "C:\Users\hp\Downloads\Programs\king's-sword\public\songs.json"
$content = Get-Content $path
$content | Select-String -Pattern '"language":' | Select-String -NotMatch '"en"' | ForEach-Object { $_.LineNumber }
