import fs from 'fs';
import path from 'path';

// Allows overriding autumn colors via env or a JSON file
// ENV: THEME_JSON='{"autumn":{"500":"#f97316"}}'
const theme = process.env.THEME_JSON ? JSON.parse(process.env.THEME_JSON) : {};

const defaults = {
    autumn: {
        50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12'
    }
};

const merged = { ...defaults.autumn, ...(theme.autumn || {}) };

const css = `:root{${Object.entries(merged).map(([k, v]) => `--autumn-${k}:${v};`).join('')}}`;

const stylesPath = path.join('client', 'src', 'styles.css');
let content = fs.readFileSync(stylesPath, 'utf8');
content = content.replace(/:root\{[\s\S]*?\}/, css);
fs.writeFileSync(stylesPath, content);
console.log('Theme variables written');


