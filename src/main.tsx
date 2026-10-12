import React from 'react';import{createRoot}from'react-dom/client';import App from'./ui/App';import'./ui/styles.css';
import './ui/catalog.css';
import './ui/mobile.css';
import {createHashRouter,RouterProvider} from 'react-router-dom';
const router=createHashRouter([{path:'*',element:<App/>}]);
createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router}/></React.StrictMode>);
