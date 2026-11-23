import { Routes } from '@angular/router';
import { Home } from './home/home';
import { Login } from './login/login';
import { Commutes } from './commutes/commutes';
import { Register } from './register/register/register';

export const routes: Routes = [
  { path: '', component: Home, title: 'Spitsrit' },
  { path: 'login', component: Login, title: 'Log in · Spitsrit' },
  { path: 'register', component: Register, title: 'Create an account · Spitsrit' },
  {
    path: 'commutes',
    component: Commutes,
    title: 'Commutes · Spitsrit',
  },
  { path: '**', redirectTo: '' },
];
