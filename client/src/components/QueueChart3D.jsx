import { useEffect, useRef } from 'react';
import {
  BoxGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { label } from '../utils/format.js';

const COLOURS = { urgent: 0xc0392b, high: 0xd9731a, medium: 0xb8941f, low: 0x3e8e5e };
const STEP = 1.45;
const MAX_HEIGHT = 3.4;

const rowName = (category) => (category ? label(category) : 'Untriaged');
const withUntriaged = (categories) => [...categories, null]; // null category = still untriaged
const cell = (matrix, category, priority) =>
  matrix.find((m) => m.category === category && m.priority === priority)?.count ?? 0;

function tag(text, className, anchorX = 0.5) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  const object = new CSS2DObject(div);
  object.center.set(anchorX, 0.5); // 0 = text starts at the point, 0.5 = centred on it
  return object;
}

/**
 * Open tickets as bars: one row per category (plus untriaged), one column per
 * priority. Drag to turn it; hover a bar for its count. The same numbers are in
 * a table for screen readers.
 */
export default function QueueChart3D({ matrix, categories, priorities }) {
  const host = useRef(null);
  const tip = useRef(null);
  const key = JSON.stringify({ matrix, categories, priorities });

  useEffect(() => {
    const data = JSON.parse(key);
    const allRows = withUntriaged(data.categories);
    const el = host.current;
    const tipEl = tip.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'chart3d__labels';
    el.appendChild(labels.domElement);

    const scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0x9aa6b2, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.5);
    sun.position.set(6, 12, 8);
    scene.add(sun);

    const width = data.priorities.length * STEP;
    const depth = allRows.length * STEP;
    const centre = new Vector3((width - STEP) / 2, 0, (depth - STEP) / 2);
    const camera = new PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(centre.x + 7.5, 8.5, centre.z + 10);

    const controls = new OrbitControls(camera, labels.domElement);
    controls.target.copy(centre);
    controls.enablePan = false;
    controls.enableDamping = !reduceMotion;
    controls.minDistance = 8;
    controls.maxDistance = 24;
    controls.maxPolarAngle = Math.PI * 0.46;

    const owned = [];
    const own = (resource) => {
      owned.push(resource);
      return resource;
    };

    const floor = new Mesh(own(new BoxGeometry(width + 0.6, 0.06, depth + 0.6)),
                                 own(new MeshStandardMaterial({ color: 0xe8ecef })));
    floor.position.set(centre.x, -0.04, centre.z);
    scene.add(floor);

    const max = Math.max(1, ...data.matrix.map((m) => m.count));
    const empty = own(new MeshStandardMaterial({ color: 0xc9d0d7 }));
    const fills = Object.fromEntries(data.priorities.map((p) => [
      p, own(new MeshStandardMaterial({ color: COLOURS[p] ?? 0x1c5d99, roughness: 0.6 })),
    ]));
    const bars = [];

    allRows.forEach((category, r) => {
      data.priorities.forEach((priority, c) => {
        const n = cell(data.matrix, category, priority);
        const height = n ? 0.25 + (MAX_HEIGHT * n) / max : 0.03;
        const bar = new Mesh(own(new BoxGeometry(0.95, height, 0.95)),
                                   n ? fills[priority] : empty);
        bar.position.set(c * STEP, height / 2, r * STEP);
        bar.userData = { text: `${rowName(category)}, ${label(priority)}: ${n} open` };
        scene.add(bar);
        bars.push(bar);
        if (n) {
          const value = tag(String(n), 'chart3d__value');
          value.position.set(c * STEP, height + 0.3, r * STEP);
          scene.add(value);
        }
      });
      // Row names sit on the right edge, nearest the camera, so bars never cover them.
      const name = tag(rowName(category), 'chart3d__label', 0);
      name.position.set(width - STEP + 0.75, 0.1, r * STEP);
      scene.add(name);
    });
    data.priorities.forEach((priority, c) => {
      const name = tag(label(priority), 'chart3d__label');
      name.position.set(c * STEP, 0.1, depth - 0.1);
      scene.add(name);
    });

    const render = () => {
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };

    const pointer = new Vector2();
    const ray = new Raycaster();
    const hover = (event) => {
      const box = labels.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - box.left) / box.width) * 2 - 1,
                  -((event.clientY - box.top) / box.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(bars)[0];
      tipEl.hidden = !hit;
      if (hit) {
        tipEl.textContent = hit.object.userData.text;
        tipEl.style.transform = `translate(${event.clientX - box.left + 14}px, ${event.clientY - box.top + 14}px)`;
      }
    };
    const leave = () => {
      tipEl.hidden = true;
    };
    labels.domElement.addEventListener('pointermove', hover);
    labels.domElement.addEventListener('pointerleave', leave);

    const resize = () => {
      const { width: w, height: h } = el.getBoundingClientRect();
      if (!w || !h) return;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let frame = 0;
    if (reduceMotion) {
      controls.addEventListener('change', render);
      controls.update();
    } else {
      const tick = () => {
        controls.update();
        render();
        frame = requestAnimationFrame(tick);
      };
      tick();
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      labels.domElement.removeEventListener('pointermove', hover);
      labels.domElement.removeEventListener('pointerleave', leave);
      controls.dispose();
      owned.forEach((resource) => resource.dispose());
      renderer.dispose();
      el.replaceChildren();
    };
  }, [key]);

  return (
    <figure className="chart3d">
      <div ref={host} className="chart3d__canvas" />
      <div ref={tip} className="chart3d__tip" hidden />
      <figcaption className="muted">Open tickets by category and priority. Drag to turn the chart.</figcaption>
      <table className="sr-only">
        <caption>Open tickets by category and priority</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            {priorities.map((p) => <th key={p} scope="col">{label(p)}</th>)}
          </tr>
        </thead>
        <tbody>
          {withUntriaged(categories).map((c) => (
            <tr key={c ?? 'untriaged'}>
              <th scope="row">{rowName(c)}</th>
              {priorities.map((p) => <td key={p}>{cell(matrix, c, p)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
