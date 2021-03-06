FROM node:12-stretch AS builder
WORKDIR /srv/www

# build binary in this repository

COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run compile && npm prune --production

#########################################
# Prepare runtime environment
FROM node:12-stretch-slim

# See https://crbug.com/795759
# RUN apt-get update && apt-get install -yq libgconf-2-4
RUN apt-get update && apt-get -yq upgrade && apt-get install \
  && apt-get autoremove -y && apt-get autoclean

# Install latest chrome dev package and fonts to support major charsets (Chinese, Japanese, Arabic, Hebrew, Thai and a few others)
# Note: this installs the necessary libs to make the bundled version of Chromium that Puppeteer
# installs, work.
# Ref: Install only the dependencies - https://serverfault.com/a/577951
RUN apt-get update && apt-get install -y gnupg wget ca-certificates --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y `apt-cache depends google-chrome-unstable | awk '/Depends:/{print$2}'` fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst ttf-freefont \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /src/*.deb

# It's a good idea to use dumb-init to help prevent zombie chrome processes.
ADD https://github.com/Yelp/dumb-init/releases/download/v1.2.1/dumb-init_1.2.1_amd64 /usr/local/bin/dumb-init
RUN chmod +x /usr/local/bin/dumb-init

# Add user so we don't need --no-sandbox.
# DOESN'T WORK WITH SANDBOX -- https://github.com/Googlechrome/puppeteer/issues/290
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# Move built repository binary from builder image
WORKDIR /srv/www
COPY --from=builder /srv/www .

# Run everything after as non-privileged user.
USER pptruser

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
