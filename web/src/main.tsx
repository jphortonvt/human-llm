import React from 'react';
import ReactDOM from 'react-dom/client';
import { Link, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { DisplayPage } from './routes/display';
import { VotePage } from './routes/vote';
import { CuratorPage } from './routes/curator';
import './styles/globals.css';

function Index() {
  return (
    <div className="page">
      <div className="dim" style={{ marginBottom: 24 }}>human llm</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Link to="/display">display</Link>
        <Link to="/vote">vote</Link>
        <Link to="/curator">curator</Link>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Index /> },
  { path: '/display', element: <DisplayPage /> },
  { path: '/vote', element: <VotePage /> },
  { path: '/curator', element: <CuratorPage /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
