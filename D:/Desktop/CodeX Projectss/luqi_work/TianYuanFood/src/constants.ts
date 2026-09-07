/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, CultureTimeline } from './types';

export const PRODUCTS: Product[] = [
  {
    id: '1',
    name: '锅包肉',
    category: '肉禽类',
    description: '甄选优质猪里脊肉，传统工艺制作，外酥里嫩，酸甜可口。',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Chinese%20guobaorou%20crispy%20sweet%20and%20sour%20pork%20fillet%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd',
  },
  {
    id: '2',
    name: '韩式炸鸡',
    category: '肉禽类',
    description: '经典韩式风味，外皮酥脆，肉质鲜嫩多汁。',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Korean%20fried%20chicken%20crispy%20golden%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd',
  },
  {
    id: '3',
    name: '鸡米花',
    category: '肉禽类',
    description: '精选鸡胸肉，外皮金黄酥脆，内里肉质细嫩。',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=chicken%20popcorn%20crispy%20golden%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd',
  },
  {
    id: '4',
    name: '卡兹脆鸡排',
    category: '肉禽类',
    description: '严选鸡胸肉，秘制裹粉，口感酥脆，咔滋可口。',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=crispy%20chicken%20cutlet%20breaded%20fried%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd',
  },
  {
    id: '5',
    name: '糖醋里脊',
    category: '肉禽类',
    description: '精选猪里脊肉，酸甜适口，色泽诱人。',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Chinese%20sweet%20and%20sour%20pork%20tenderloin%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd',
  },
];

export const TIMELINE: CultureTimeline[] = [
  { year: '1998', event: '田原食品有限公司于山东成立，开启食品加工探索之路。' },
  { year: '2005', event: '投产现代化生产基地，通过HACCP质量管理体系认证。' },
  { year: '2012', event: '业务扩展至全国，建立完善的冷链物流配送网络。' },
  { year: '2018', event: '荣获“农业产业化省级重点龙头企业”称号。' },
  { year: '2023', event: '启动数字化转型，实现生产全过程透明可追溯。' },
];

export const CATEGORIES = ['全部', '肉禽类', '水产类', '蔬食类'];

export const HERO_IMAGES = [
  'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=green%20ecological%20farm%20pasture%20cattle%20sheep%20sunny%20natural%20landscape%20agriculture%20photography&image_size=landscape_16_9',
  'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=modern%20food%20processing%20factory%20clean%20workshop%20stainless%20steel%20equipment%20professional%20workers&image_size=landscape_16_9',
  'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=delicious%20prepared%20food%20spread%20variety%20dishes%20restaurant%20quality%20vibrant%20colors%20appetizing&image_size=landscape_16_9',
];

export const CULTURE_IMAGE = '/src/assets/images/tianyuan_culture_history_1779110098186.png';
