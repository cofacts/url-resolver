#/bin/bash

npm start &
wget --post-data='{"query":"{ resolvedUrls(urls: [\"example.com\"]) { url }}"}' --header='Content-Type: application/json' -O - http://localhost:4000
