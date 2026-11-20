import { Injectable, computed, inject, signal } from '@angular/core';
import { Api } from './api/api';
import {
  authLoginCreate,
  authLogoutCreate,
  authMeRetrieve,
  authRegisterCreate,
} from './api/functions';
import { User } from './api/models';

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly api = inject(Api);

  readonly user = signal<User | null>(null);
  readonly loggedIn = computed(() => this.user() !== null);

  /** Loads the logged-in user. The response also sets Django's CSRF cookie. */
  async load(): Promise<void> {
    // The endpoint answers 204 with no body when logged out.
    const user: User | null = await this.api.invoke(authMeRetrieve);
    this.user.set(user);
  }

  async login(email: string, password: string): Promise<void> {
    this.user.set(await this.api.invoke(authLoginCreate, { body: { email, password } }));
  }

  /** Creates the account; the server logs the new user in. */
  async register(email: string, password: string): Promise<void> {
    this.user.set(await this.api.invoke(authRegisterCreate, { body: { email, password } }));
  }

  async logout(): Promise<void> {
    await this.api.invoke(authLogoutCreate);
    this.user.set(null);
  }
}
