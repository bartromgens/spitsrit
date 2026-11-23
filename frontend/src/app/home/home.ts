import { Component } from '@angular/core';
import { TripPlanner } from '../trip-planner/trip-planner';

@Component({
  imports: [TripPlanner],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home {}
