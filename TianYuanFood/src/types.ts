/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum Tab {
  Home = 'home',
  Culture = 'culture',
  Products = 'products',
  Contact = 'contact',
}

export interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  image: string;
}

export interface CultureTimeline {
  year: string;
  event: string;
}
