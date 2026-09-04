import React, { useEffect } from 'react';
import { useToast } from '../context/ToastContext';

export default function TestToast() {
  const toast = useToast();
  useEffect(() => {
    toast.success('Test Success');
    toast.warning('Test Warning');
  }, []);
  return <div>Test</div>;
}
