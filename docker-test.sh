#/bin/bash

node index.js &
sleep 10
node docker-test.js
