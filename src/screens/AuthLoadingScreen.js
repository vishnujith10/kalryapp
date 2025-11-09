import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import supabase, { handleSessionExpiry } from '../lib/supabase';

const AuthLoadingScreen = ({ navigation }) => {
  useEffect(() => {
    const checkAuthAndOnboarding = async () => {
      try {
      // 1. Check Supabase auth with "Remember Me" functionality
      const session = await handleSessionExpiry();
      if (!session) {
          // Use reset to clear navigation stack completely
          navigation.reset({
            index: 0,
            routes: [{ name: 'Welcome' }],
          });
        return;
      }
        
        // 2. Check onboarding status by checking if profile has essential fields
        // No need for separate onboarded column - we can infer from profile data
        let onboarded = true; // Default to true - assume user is onboarded unless proven otherwise
        
        try {
          // Check profile directly from database (most reliable source of truth)
          const { data: profile, error: profileError } = await supabase
          .from('user_profile')
            .select('name, age, gender, height, weight, calorie_goal')
          .eq('id', session.user.id)
          .single();
          
          if (profileError) {
            console.error('Error fetching profile:', profileError);
            // If profile doesn't exist (PGRST116 = not found), user is not onboarded
            if (profileError.code === 'PGRST116' || profileError.message?.includes('No rows')) {
              onboarded = false;
              await AsyncStorage.setItem('onboarded', 'false');
            } else {
              // On other errors (network, etc.), check AsyncStorage as fallback
              // If AsyncStorage says onboarded, trust it; otherwise default to true for logged-in users
              const cachedOnboarded = await AsyncStorage.getItem('onboarded');
              if (cachedOnboarded === 'true') {
                onboarded = true;
              } else {
                // Default to true for logged-in users (safer - assume they've completed onboarding)
                onboarded = true;
                console.log('⚠️ Profile fetch error, defaulting to onboarded=true for logged-in user');
              }
            }
          } else if (profile) {
            // Check if essential onboarding fields are present
            // User is considered onboarded if they have name, age, gender, height, weight, and calorie_goal
            const hasEssentialFields = 
              profile.name && 
              profile.age && 
              profile.gender && 
              profile.height && 
              profile.weight && 
              profile.calorie_goal;
            
            onboarded = !!hasEssentialFields;
            
            // Update AsyncStorage to match database state
            await AsyncStorage.setItem('onboarded', onboarded ? 'true' : 'false');
          } else {
            // No profile found, user is not onboarded
            onboarded = false;
            await AsyncStorage.setItem('onboarded', 'false');
          }
        } catch (error) {
          console.error('Error checking onboarding status:', error);
          // On any error, default to onboarded = true to show MainDashboard (safer for logged-in users)
          onboarded = true;
      }
        
        // For logged-in users: Always go to MainDashboard unless we're certain they haven't onboarded
        // Only go to Profile if profile doesn't exist or is clearly incomplete
        // Use reset() to clear navigation stack and prevent back navigation to AuthLoading
      if (onboarded) {
          navigation.reset({
            index: 0,
            routes: [{ name: 'MainDashboard' }],
          });
      } else {
          navigation.reset({
            index: 0,
            routes: [{ name: 'Profile' }], // First onboarding screen
          });
        }
      } catch (error) {
        console.error('Error in AuthLoadingScreen:', error);
        // On critical error, default to MainDashboard with reset to clear stack
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainDashboard' }],
        });
      }
    };
    checkAuthAndOnboarding();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#7B61FF" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
});

export default AuthLoadingScreen; 