import './style.css';
import { Simulation } from './sim/Simulation';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('#app root missing');
}

const sim = new Simulation(app);
sim.start();
