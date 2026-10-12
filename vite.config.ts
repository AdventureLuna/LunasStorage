import { defineConfig } from 'vitest/config';import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],base:'/',server:{proxy:{'/api':{target:'http://127.0.0.1:'+(process.env.INVENTORY_PORT??'8000'),changeOrigin:false}}},test:{environment:'jsdom'}});
