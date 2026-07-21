declare module '@react-navigation/native';
declare module '@react-navigation/native-stack';
declare module '@react-navigation/bottom-tabs';

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_ENABLE_PRO?: string;
  }
}