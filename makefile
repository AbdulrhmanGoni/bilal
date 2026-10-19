UUID = bilal@king.it
ZIP = bilal.zip

.PHONY: all pack install sync clean

all: dist/extension.js

node_modules/.package-lock.json: package.json
	npm install

dist/extension.js: node_modules/.package-lock.json extension.ts
	npm run build

$(ZIP): dist/extension.js
	(cd dist && zip ../$(ZIP) -9r .)

pack: $(ZIP)

install: $(ZIP)
	gnome-extensions install --force $(ZIP)

sync: dist/extension.js
	./install.sh

clean:
	rm -rf dist node_modules $(ZIP)
