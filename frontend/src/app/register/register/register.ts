import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Auth } from '../../auth';

@Component({
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  selector: 'app-register',
  styleUrl: './register.scss',
  templateUrl: './register.html',
})
export class Register {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly errors = signal<string[]>([]);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      return;
    }
    const { email, password } = this.form.getRawValue();
    try {
      await this.auth.register(email, password);
    } catch (error) {
      this.errors.set(messagesFrom(error));
      return;
    }
    await this.router.navigateByUrl('/commutes');
  }
}

/** The validation messages in a 400 response, or a generic one. */
function messagesFrom(error: unknown): string[] {
  if (error instanceof HttpErrorResponse && error.status === 400 && error.error) {
    const messages = Object.values(error.error as Record<string, unknown>)
      .flat()
      .filter((message): message is string => typeof message === 'string');
    if (messages.length > 0) {
      return messages;
    }
  }
  return ['Creating the account failed. Please try again.'];
}
