import ErrorScreen from '@/components/ErrorScreen';

export const metadata = { title: 'Page not found · Diffusion Cube' };

export default function NotFound() {
  return <ErrorScreen title="Page not found" message="The page you're looking for doesn't exist or has moved." />;
}
