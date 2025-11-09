import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import 'react-native-url-polyfill/auto';
import supabase from '../lib/supabase';

// Configure Google Sign-In once when app starts
export const initializeGoogleSignIn = () => {
  GoogleSignin.configure({
    webClientId: process.env.GOOGLE_WEB_CLIENT_ID, // Replace with your actual Web Client ID
    offlineAccess: false,
  });
};

// Main Google Sign-In function
export const handleGoogleSignIn = async () => {
  try {
    // Check for Play Services
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    
    // Sign in with Google
    const signInResult = await GoogleSignin.signIn();
    
    // Extract idToken from either response format
    const idToken = signInResult?.data?.idToken || signInResult?.idToken;
    
    if (!idToken) {
      throw new Error(
        'No ID token received from Google. Please check:\n' +
        '1. webClientId is correct (Web Application type from Google Cloud)\n' +
        '2. offlineAccess is set to false\n' +
        '3. SHA-1 fingerprint is configured in Google Cloud Console'
      );
    }

    console.log('✅ ID Token received from Google');

    // Sign in to Supabase with the Google ID token
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    if (!data.user) {
      throw new Error('No user data received from Supabase');
    }

    console.log('✅ Successfully signed in:', data.user.email);
    
    // Return success response
    return {
      success: true,
      user: data.user,
      message: `Welcome ${data.user.user_metadata?.full_name || data.user.email}!`,
    };
    
  } catch (error) {
    console.error('Sign-in error:', error);

    // Handle specific error codes
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      // User cancelled - return silently without error
      return {
        success: false,
        message: 'Sign-in cancelled',
      };
    } else if (error.code === statusCodes.IN_PROGRESS) {
      return {
        success: false,
        message: 'Sign-in already in progress',
      };
    } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return {
        success: false,
        message: 'Play Services not available or outdated. Please update Google Play Services.',
      };
    } else {
      // Check if error message indicates cancellation
      const errorMessage = error.message || error.toString() || '';
      if (errorMessage.toLowerCase().includes('cancel') || 
          errorMessage.toLowerCase().includes('user_cancelled') ||
          error.code === 'SIGN_IN_CANCELLED') {
        return {
          success: false,
          message: 'Sign-in cancelled',
        };
      }
      
      return {
        success: false,
        message: errorMessage || 'Failed to sign in with Google. Please try again.',
      };
    }
  }
};

// Sign out function
export const handleGoogleSignOut = async () => {
  try {
    await GoogleSignin.signOut();
    await supabase.auth.signOut();
    console.log('✅ Signed out successfully');
    return { success: true };
  } catch (error) {
    console.error('Sign-out error:', error);
    return {
      success: false,
      message: error.message || 'Failed to sign out',
    };
  }
};
