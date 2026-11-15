import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { healthSchema } from '@playground/shared';
import './style.css';

function App() {
  const [status, setStatus] = useState('Проверяем соединение…');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Unavailable');
        healthSchema.parse(await response.json());
        setStatus('Сервер и база данных доступны');
      })
      .catch(() => { if (!controller.signal.aborted) setStatus('Нет связи с сервером. Попробуйте обновить страницу.'); });
    return () => controller.abort();
  }, []);
  return <main>
    <header><span className="mark" aria-hidden="true">P</span><strong>playground</strong><span className="badge">Локальная среда</span></header>
    <section><p className="eyebrow">НАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Место для наших игр.</h1><p className="intro">Запускать. Тестировать. Обсуждать. Всё, над чем мы работаем, — в одном месте.</p>
      <div className="status" role="status">{status}</div>
    </section>
    <div className="modules">{[
      ['01', 'Библиотека', 'Наши игры, версии и результаты тестирования.'],
      ['02', 'Обратная связь', 'Комментарии команды рядом с каждой игрой.'],
      ['03', 'Vault', 'Общее хранилище ассетов для разработки.'],
    ].map(([number, title, description]) => <article key={number}><span className="number">{number}</span><h2>{title}</h2><p>{description}</p><small>В следующих этапах</small></article>)}</div>
    <footer>Фундамент готовится · M0 <span>Закрытая платформа для команды</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
