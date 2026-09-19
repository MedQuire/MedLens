/// <reference types="expo/types" />

declare module '@react-navigation/native';
declare module '@react-navigation/native-stack';
declare module '@react-navigation/bottom-tabs';

declare module 'expo-web-browser';
declare module 'expo-linking';
declare module 'expo-auth-session';

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_ENABLE_PRO?: string;
  }
}