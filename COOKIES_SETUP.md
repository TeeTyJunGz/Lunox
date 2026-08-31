# YouTube Cookies Setup for yt-dlp

Some YouTube videos require authentication (bot detection). To fix this, export cookies from your browser.

## Quick Setup (Firefox/Chrome)

### Option 1: Browser Extension (Easiest)
1. Install "Get cookies.txt LOCALLY" extension
2. Go to youtube.com, log in
3. Click extension → Export cookies.txt
4. Save as `/home/ubuntu/Lunox/youtube-cookies.txt`

### Option 2: Command Line (yt-dlp built-in)
```bash
# For Firefox
yt-dlp --cookies-from-browser firefox -o /home/ubuntu/Lunox/youtube-cookies.txt ""

# For Chrome
yt-dlp --cookies-from-browser chrome -o /home/ubuntu/Lunox/youtube-cookies.txt ""
```

### Option 3: Manual Export (Firefox)
1. Install "cookies.txt" addon
2. Visit youtube.com, ensure logged in
3. Click addon → Export → Save as `youtube-cookies.txt` in Lunox folder

## Verify It Works
```bash
# Test with a video that previously failed
yt-dlp --cookies /home/ubuntu/Lunox/youtube-cookies.txt -g "https://www.youtube.com/watch?v=zZSsgmwxb7Y" -f bestaudio
```

## Notes
- Cookies expire periodically (usually weekly), re-export when needed
- The bot checks for `/home/ubuntu/Lunox/youtube-cookies.txt` automatically
- If file doesn't exist, yt-dlp runs without cookies (works for most videos)
- Restart bot after adding/updating cookies file

## Security
- `youtube-cookies.txt` contains your YouTube session - keep it private
- Already in `.gitignore` (should be)
- Only needed for age-restricted or bot-detected videos
