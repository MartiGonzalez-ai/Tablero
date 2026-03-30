const fs = require('fs');
const path = require('path');

const cssPath = path.join('c:\\Users\\user\\Downloads\\Pruebas geotab', 'styles', 'main.css');
let css = fs.readFileSync(cssPath, 'utf8');

// 1. :root variables
css = css.replace(/--color-bg-dark:\s*#0a0f1e;/, '--color-bg-dark: #f8fafc;');
css = css.replace(/--color-bg-surface:\s*#0f172a;/, '--color-bg-surface: #ffffff;');
css = css.replace(/--color-bg-panel:\s*rgba\(15, 23, 42, 0\.85\);/, '--color-bg-panel: rgba(255, 255, 255, 0.85);');
css = css.replace(/--color-panel-border:\s*rgba\(255, 255, 255, 0\.08\);/, '--color-panel-border: rgba(0, 0, 0, 0.08);');

css = css.replace(/--color-primary:\s*#38bdf8;/, '--color-primary: #0ea5e9;');
css = css.replace(/--color-primary-glow:\s*rgba\(56, 189, 248, 0\.35\);/, '--color-primary-glow: rgba(14, 165, 233, 0.35);');

css = css.replace(/--color-text-main:\s*#f1f5f9;/, '--color-text-main: #0f172a;');
css = css.replace(/--color-text-muted:\s*#64748b;/, '--color-text-muted: #475569;');
css = css.replace(/--color-text-sub:\s*#94a3b8;/, '--color-text-sub: #64748b;');

css = css.replace(/--c-orange:\s*#f97316;/, '--c-orange: #ea580c;');
css = css.replace(/--c-orange-glow:\s*rgba\(249, 115, 22, 0\.40\);/, '--c-orange-glow: rgba(234, 88, 12, 0.30);');

css = css.replace(/--c-blue:\s*#60a5fa;/, '--c-blue: #2563eb;');
css = css.replace(/--c-blue-glow:\s*rgba\(96, 165, 250, 0\.40\);/, '--c-blue-glow: rgba(37, 99, 235, 0.30);');

css = css.replace(/--c-red:\s*#f43f5e;/, '--c-red: #e11d48;');
css = css.replace(/--c-red-glow:\s*rgba\(244, 63, 94, 0\.40\);/, '--c-red-glow: rgba(225, 29, 72, 0.30);');

css = css.replace(/--c-purple:\s*#a855f7;/, '--c-purple: #9333ea;');
css = css.replace(/--c-purple-glow:\s*rgba\(168, 85, 247, 0\.40\);/, '--c-purple-glow: rgba(147, 51, 234, 0.30);');

css = css.replace(/--c-green:\s*#22c55e;/, '--c-green: #16a34a;');
css = css.replace(/--c-green-glow:\s*rgba\(34, 197, 94, 0\.40\);/, '--c-green-glow: rgba(22, 163, 74, 0.30);');

css = css.replace(/--c-cyan:\s*#06b6d4;/, '--c-cyan: #0891b2;');
css = css.replace(/--c-cyan-glow:\s*rgba\(6, 182, 212, 0\.40\);/, '--c-cyan-glow: rgba(8, 145, 178, 0.30);');

css = css.replace(/--shadow-lg:\s*0 20px 60px -10px rgba\(0, 0, 0, 0\.6\);/, '--shadow-lg: 0 10px 40px -10px rgba(0, 0, 0, 0.1);');
css = css.replace(/--shadow-glow:\s*0 0 30px -5px;/, '--shadow-glow: 0 0 20px -5px;');

// Body gradient
css = css.replace(/rgba\(6, 182, 212, 0\.10\)/g, 'rgba(8, 145, 178, 0.06)');
css = css.replace(/rgba\(34, 197, 94, 0\.06\)/g, 'rgba(22, 163, 74, 0.04)');

// Header title gradient
css = css.replace(/linear-gradient\(135deg, #ffffff 30%, #94a3b8 100%\)/, 'linear-gradient(135deg, #0f172a 30%, #475569 100%)');

// Hardcoded transparency changes

// Date range group
css = css.replace(/\.date-range-group \{\s*display: flex;\s*background: rgba\(0, 0, 0, 0\.25\);/, '.date-range-group {\n    display: flex;\n    background: rgba(0, 0, 0, 0.05);');
css = css.replace(/\.btn-range:hover \{\s*background: rgba\(255, 255, 255, 0\.06\);/, '.btn-range:hover {\n    background: rgba(0, 0, 0, 0.06);');
css = css.replace(/\.btn-range\.active \{\s*background: var\(--c-cyan\);\s*color: #000;/, '.btn-range.active {\n    background: var(--c-cyan);\n    color: #fff;');

// Date popover box shadow
css = css.replace(/box-shadow: 0 24px 60px -8px rgba\(0, 0, 0, 0\.7\), 0 0 0 1px rgba\(255, 255, 255, 0\.07\);/, 'box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.07);');

// Date input
css = css.replace(/\.date-input \{\s*([\s\S]*?)background: rgba\(0, 0, 0, 0\.25\);\s*border: 1px solid rgba\(255, 255, 255, 0\.1\);([\s\S]*?)color-scheme: dark;/g, '.date-input {\n$1background: rgba(0, 0, 0, 0.04);\n    border: 1px solid rgba(0, 0, 0, 0.1);$2color-scheme: light;');

css = css.replace(/\.btn-popover-cancel \{\s*background: transparent;\s*border: 1px solid rgba\(255, 255, 255, 0\.1\);/g, '.btn-popover-cancel {\n    background: transparent;\n    border: 1px solid rgba(0, 0, 0, 0.1);');
css = css.replace(/\.btn-popover-cancel:hover \{\s*background: rgba\(255, 255, 255, 0\.05\);/g, '.btn-popover-cancel:hover {\n    background: rgba(0, 0, 0, 0.04);');
css = css.replace(/\.btn-popover-apply \{\s*([\s\S]*?)color: #000;/g, '.btn-popover-apply {\n$1color: #fff;');

// Refresh button
css = css.replace(/\.btn-refresh \{\s*([\s\S]*?)background: rgba\(255, 255, 255, 0\.05\);/g, '.btn-refresh {\n$1background: rgba(0, 0, 0, 0.04);');

// Stat card background
css = css.replace(/\.stat-card \{\s*([\s\S]*?)background: rgba\(15, 23, 42, 0\.7\);/g, '.stat-card {\n$1background: rgba(255, 255, 255, 0.7);');

// Search input
css = css.replace(/\.search-input \{\s*([\s\S]*?)background: rgba\(0, 0, 0, 0\.2\);\s*border: 1px solid rgba\(255, 255, 255, 0\.08\);/g, '.search-input {\n$1background: rgba(0, 0, 0, 0.04);\n    border: 1px solid rgba(0, 0, 0, 0.08);');
css = css.replace(/\.search-input:focus \{\s*([\s\S]*?)background: rgba\(6, 182, 212, 0\.04\);/g, '.search-input:focus {\n$1background: rgba(8, 145, 178, 0.04);');

// Ranking
css = css.replace(/\.ranking-item:hover \{\s*background: rgba\(255, 255, 255, 0\.04\);\s*\}/g, '.ranking-item:hover { background: rgba(0, 0, 0, 0.03); }');
css = css.replace(/\.ranking-pos \{\s*([\s\S]*?)background: rgba\(255, 255, 255, 0\.07\);\s*border: 1px solid rgba\(255, 255, 255, 0\.1\);/g, '.ranking-pos {\n$1background: rgba(0, 0, 0, 0.04);\n    border: 1px solid rgba(0, 0, 0, 0.08);');
css = css.replace(/\.ranking-bar-wrap \{\s*([\s\S]*?)background: rgba\(255, 255, 255, 0\.07\);/g, '.ranking-bar-wrap {\n$1background: rgba(0, 0, 0, 0.06);');

// Table
css = css.replace(/\.fillup-table thead \{\s*([\s\S]*?)background: rgba\(15, 23, 42, 0\.97\);/g, '.fillup-table thead {\n$1background: rgba(255, 255, 255, 0.97);');
css = css.replace(/\.fillup-table td \{\s*([\s\S]*?)border-bottom: 1px solid rgba\(255, 255, 255, 0\.04\);/g, '.fillup-table td {\n$1border-bottom: 1px solid rgba(0, 0, 0, 0.05);');
css = css.replace(/\.fillup-row:hover td \{\s*background: rgba\(6, 182, 212, 0\.04\);\s*\}/g, '.fillup-row:hover td {\n    background: rgba(8, 145, 178, 0.04);\n}');
css = css.replace(/\.vol-low \{ background: rgba\(255, 255, 255, 0\.06\); color: var\(--color-text-sub\); border: 1px solid rgba\(255,255,255,0\.1\); \}/g, '.vol-low { background: rgba(0, 0, 0, 0.04); color: var(--color-text-sub); border: 1px solid rgba(0,0,0,0.08); }');

// Skeleton backgrounds
css = css.replace(/background: linear-gradient\(90deg,[\s\n]*rgba\(255, 255, 255, 0\.04\) 25%,[\s\n]*rgba\(255, 255, 255, 0\.08\) 50%,[\s\n]*rgba\(255, 255, 255, 0\.04\) 75%\);/g, 'background: linear-gradient(90deg, rgba(0, 0, 0, 0.03) 25%, rgba(0, 0, 0, 0.06) 50%, rgba(0, 0, 0, 0.03) 75%);');
css = css.replace(/background: linear-gradient\(90deg,[\s\n]*rgba\(255, 255, 255, 0\.04\) 25%,[\s\n]*rgba\(255, 255, 255, 0\.09\) 50%,[\s\n]*rgba\(255, 255, 255, 0\.04\) 75%\);/g, 'background: linear-gradient(90deg, rgba(0, 0, 0, 0.03) 25%, rgba(0, 0, 0, 0.06) 50%, rgba(0, 0, 0, 0.03) 75%);');
css = css.replace(/background: linear-gradient\(90deg,[\s\n]*rgba\(255, 255, 255, 0\.04\) 25%,[\s\n]*rgba\(255, 255, 255, 0\.10\) 50%,[\s\n]*rgba\(255, 255, 255, 0\.04\) 75%\);/g, 'background: linear-gradient(90deg, rgba(0, 0, 0, 0.03) 25%, rgba(0, 0, 0, 0.06) 50%, rgba(0, 0, 0, 0.03) 75%);');

css = css.replace(/\.tr-skeleton td \{ padding: 0\.5rem 1rem; border-bottom: 1px solid rgba\(255,255,255,0\.04\); \}/, '.tr-skeleton td { padding: 0.5rem 1rem; border-bottom: 1px solid rgba(0,0,0,0.05); }');

css = css.replace(/::-webkit-scrollbar-thumb \{ background: rgba\(255, 255, 255, 0\.12\); border-radius: 10px; \}/, '::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 10px; }');
css = css.replace(/::-webkit-scrollbar-thumb:hover \{ background: rgba\(255, 255, 255, 0\.22\); \}/, '::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.25); }');

fs.writeFileSync(cssPath, css);
console.log('Light mode applied!');
