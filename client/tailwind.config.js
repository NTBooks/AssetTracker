/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                // Will be written by theme build script
                autumn: {
                    50: 'var(--autumn-50)',
                    100: 'var(--autumn-100)',
                    200: 'var(--autumn-200)',
                    300: 'var(--autumn-300)',
                    400: 'var(--autumn-400)',
                    500: 'var(--autumn-500)',
                    600: 'var(--autumn-600)',
                    700: 'var(--autumn-700)',
                    800: 'var(--autumn-800)',
                    900: 'var(--autumn-900)'
                }
            }
        }
    },
    plugins: []
};


