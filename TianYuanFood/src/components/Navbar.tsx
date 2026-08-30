/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tab } from '../types';
import { motion } from 'motion/react';
import { Menu, X, Leaf } from 'lucide-react';
import { useState } from 'react';

interface NavbarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export default function Navbar({ activeTab, onTabChange }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { label: '首页', id: Tab.Home },
    { label: '田原文化', id: Tab.Culture },
    { label: '田原产品', id: Tab.Products },
    { label: '联系我们', id: Tab.Contact },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20 items-center">
          <div 
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => onTabChange(Tab.Home)}
          >
            <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white rounded-sm rotate-45"></div>
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight text-emerald-900">田原食品</span>
              <span className="text-[10px] uppercase tracking-widest text-emerald-600 -mt-1">Tianyuan Food Co.</span>
            </div>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex gap-10">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`relative px-1 py-2 text-sm font-semibold transition-colors transition-all ${
                  activeTab === item.id 
                    ? 'text-emerald-700' 
                    : 'text-slate-500 hover:text-emerald-600'
                }`}
              >
                {item.label}
                {activeTab === item.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600"
                    initial={false}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Mobile Toggle */}
          <div className="md:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="text-slate-800 p-2"
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-b border-slate-100 overflow-hidden"
          >
            <div className="px-4 pt-2 pb-6 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    onTabChange(item.id);
                    setIsOpen(false);
                  }}
                  className={`block w-full text-left px-4 py-3 text-base font-semibold rounded-xl ${
                    activeTab === item.id
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

// Helper to keep AnimatePresence import clean
import { AnimatePresence } from 'motion/react';
