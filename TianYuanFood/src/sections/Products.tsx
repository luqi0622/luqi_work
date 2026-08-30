/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PRODUCTS, CATEGORIES } from '../constants';
import { Search, Filter, Info } from 'lucide-react';

export default function ProductsSection() {
  const [activeCategory, setActiveCategory] = useState('全部');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredProducts = PRODUCTS.filter((p) => {
    const matchesCategory = activeCategory === '全部' || p.category === activeCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen pb-24 font-sans">
      <div className="bg-emerald-600 py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white space-y-6">
          <div className="w-16 h-1.5 bg-emerald-400 mx-auto rounded-full"></div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">田原精品目录</h1>
          <p className="text-emerald-50/80 max-w-2xl mx-auto text-lg font-light">
            依托现代化食品科研实力，为您奉献每一口都惊艳的高品质调理食品。
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -translate-y-10">
        <div className="bg-white rounded-3xl shadow-xl shadow-emerald-950/5 border border-slate-100 p-4 md:p-6 flex flex-col md:flex-row gap-6 items-center">
          {/* Category Filter */}
          <div className="flex flex-wrap justify-center gap-2 flex-grow">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                  activeCategory === cat
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                    : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
            <input 
              type="text" 
              placeholder="搜索产品..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-100 rounded-full pl-12 pr-6 py-3 text-sm focus:ring-2 focus:ring-emerald-600/10 transition-all outline-none"
            />
          </div>
        </div>
      </div>

      {/* Product Grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12">
        {filteredProducts.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <AnimatePresence mode="popLayout">
              {filteredProducts.map((product) => (
                <motion.div
                  key={product.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  whileHover={{ y: -8 }}
                  transition={{ duration: 0.3 }}
                  className="group bg-white rounded-[2rem] overflow-hidden shadow-sm border border-slate-100 hover:shadow-2xl hover:shadow-emerald-900/5 flex flex-col"
                >
                  <div className="relative aspect-[4/3] overflow-hidden m-3 rounded-[1.5rem]">
                    <img 
                      src={product.image} 
                      alt={product.name} 
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute top-4 left-4 bg-white/90 backdrop-blur rounded-full px-3 py-1 text-[9px] font-bold text-emerald-600 shadow-sm uppercase tracking-widest">
                      {product.category}
                    </div>
                  </div>
                  <div className="p-8 pt-4 space-y-3">
                    <h3 className="text-xl font-extrabold text-slate-800 tracking-tight group-hover:text-emerald-600 transition-colors">{product.name}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed line-clamp-3">
                      {product.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="py-32 text-center space-y-4 opacity-50">
            <div className="inline-flex w-20 h-20 bg-gray-100 rounded-full items-center justify-center">
              <Filter size={32} />
            </div>
            <p className="text-lg">未找到匹配的产品</p>
          </div>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-4 mt-32">
        <div className="bg-emerald-950 rounded-[3rem] p-10 md:p-16 text-center text-white space-y-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-400 blur-[120px] opacity-20 -mr-32 -mt-32" />
          <h2 className="text-3xl font-extrabold relative z-10 tracking-tight">需要大规模定制？</h2>
          <p className="text-emerald-100/60 relative z-10 text-lg">
            田原食品拥有强大的供应链整合能力，可承接餐饮连锁、生鲜商超等企业的全线调理食品 OEM/ODM 定制服务。
          </p>
          <div className="pt-4 relative z-10">
            <button className="px-12 py-4 bg-emerald-400 text-emerald-950 rounded-2xl font-extrabold hover:bg-emerald-300 transition-all uppercase tracking-widest text-sm shadow-xl shadow-emerald-400/20">
              联系我们的企业专家
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
