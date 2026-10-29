// コースの一覧（コース選択画面に出る順）。コースを足すときはここに 1 行足すだけ
import circuit from './circuit.js';
import highway from './highway.js';
import city from './city.js';
import fsae from './fsae.js';

export const COURSES = [circuit, highway, city, fsae];
export const COURSE_IDS = COURSES.map((c) => c.id);
export const getCourse = (id) => COURSES.find((c) => c.id === id) || COURSES[0];
