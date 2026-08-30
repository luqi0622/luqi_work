/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Tab } from './types';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import HomeSection from './sections/Home';
import CultureSection from './sections/Culture';
import ProductsSection from './sections/Products';
import ContactSection from './sections/Contact';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.Home);

  // Scroll to top when tab changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-[#FDFCF8] text-slate-800 font-sans selection:bg-emerald-600 selection:text-white">
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      
      <main className="pt-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {activeTab === Tab.Home && <HomeSection onNavigate={setActiveTab} />}
            {activeTab === Tab.Culture && <CultureSection />}
            {activeTab === Tab.Products && <ProductsSection />}
            {activeTab === Tab.Contact && <ContactSection />}
          </motion.div>
        </AnimatePresence>
      </main>

      <Footer activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}

