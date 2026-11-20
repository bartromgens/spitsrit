import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth';

export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(Auth).loggedIn()) {
    return true;
  }
  return inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};
