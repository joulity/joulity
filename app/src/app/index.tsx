import { Redirect } from 'expo-router';
import { useStore } from '@/lib/store';

export default function Index() {
  const { s } = useStore();
  return <Redirect href={s.user ? '/home' : '/welcome'} />;
}
