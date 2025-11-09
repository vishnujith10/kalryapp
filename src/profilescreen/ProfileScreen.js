import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import supabase from '../lib/supabase';
import { getResponsiveFontSize, getResponsivePadding } from '../utils/responsive';

// Updated FooterBar component with oval design
const FooterBar = ({ navigation, activeTab }) => {
  const insets = useSafeAreaInsets(); // Get safe area insets for bottom navigation
  const tabs = [
    {
      key: 'Home',
      label: 'Home',
      icon: <Ionicons name="home-outline" size={24} color={activeTab === 'Home' ? '#7B61FF' : '#232B3A'} />,
      route: 'MainDashboard',
    },
    
    {
      key: 'Meals',
      label: 'Meals',
      icon: <Ionicons name="barbell-outline" size={24} color={activeTab === 'Meals' ? '#232B3A' : '#232B3A'} />, // icon size 24
      route: 'Home',
    },
    {
      key: 'Workout',
      label: 'Workout',
      icon: <Ionicons name="fitness-outline" size={24} color={activeTab === 'Workout' ? '#7B61FF' : '#232B3A'} />,
      route: 'Exercise',
    },
    {
      key: 'Profile',
      label: 'Profile',
      icon: <Ionicons name="person-outline" size={24} color={activeTab === 'Profile' ? '#7B61FF' : '#232B3A'} />,
      route: 'Profile',
    },
  ];

  return (
    <View style={[footerStyles.container, { bottom: insets.bottom >= 20 ? (insets.bottom + getResponsivePadding(16)) : getResponsivePadding(16) }]}>
      <View style={footerStyles.ovalFooter}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[
              footerStyles.tab,
              tab.key === activeTab && footerStyles.activeTab
            ]}
            onPress={() => {
              // Don't navigate if already on active tab
              if (tab.key === activeTab) return;
              
              navigation.navigate(tab.route);
            }}
            activeOpacity={0.7}
          >
            {React.cloneElement(tab.icon, {
              color: tab.key === activeTab ? '#7B61FF' : '#232B3A',
            })}
            <Text
              style={[
                footerStyles.label,
                tab.key === activeTab && footerStyles.activeLabel
              ]}
            >
              {tab.label}
            </Text>
            {tab.key === activeTab && <View style={footerStyles.activeIndicator} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const ProfileScreen = () => {
  const insets = useSafeAreaInsets(); // Get safe area insets for bottom navigation
  const navigation = useNavigation();
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  
  // Fetch profile when screen mounts
  useEffect(() => {
    fetchUserProfile();
  }, []);

  // Refresh profile photo URL when screen comes into focus (handles expired URLs)
  // URLs have 10-year expiry, but refresh ensures they're always valid
  useFocusEffect(
    useCallback(() => {
      if (userProfile?.photo_url && !userProfile.photo_url.startsWith('http')) {
        // Regenerate signed URL if we have a storage path (10 years expiry)
        const refreshPhotoUrl = async () => {
          try {
            const { data: signedUrlData } = await supabase.storage
              .from('profile-photos')
              .createSignedUrl(userProfile.photo_url, 60 * 60 * 24 * 365 * 10); // 10 years expiry
            
            if (signedUrlData?.signedUrl) {
              setProfilePhotoUrl(signedUrlData.signedUrl);
            }
          } catch (error) {
            console.error('Error refreshing profile photo URL:', error);
          }
        };
        refreshPhotoUrl();
      }
    }, [userProfile?.photo_url])
  );
  
  const fetchUserProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No authenticated user found');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_profile')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (error) {
        console.error('Error fetching user profile:', error);
        setLoading(false);
        return;
      }

      // Set profile data immediately (don't wait for photo URL)
      setUserProfile(data);
      setLoading(false); // Stop loading immediately after getting profile data
      
      // Fetch profile photo asynchronously (non-blocking)
      if (data.photo_url) {
        // Don't await - let it load in background
        (async () => {
          try {
            // If it's a storage path, generate a signed URL with very long expiry (10 years)
            // Keep bucket private for security - signed URLs provide access control
            if (!data.photo_url.startsWith('http')) {
              const { data: signedUrlData } = await supabase.storage
                .from('profile-photos')
                .createSignedUrl(data.photo_url, 60 * 60 * 24 * 365 * 10); // 10 years expiry (effectively never expires)
              
              if (signedUrlData?.signedUrl) {
                setProfilePhotoUrl(signedUrlData.signedUrl);
              }
            } else {
              // If it's already a full URL, use it directly
              setProfilePhotoUrl(data.photo_url);
            }
          } catch (error) {
            console.error('Error fetching profile photo:', error);
            // Don't block UI - photo will just not show
          }
        })();
      }
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      setLoading(false);
    }
  };
  
  const handleProfilePhotoPress = async () => {
    try {
      // Launch image picker directly (same approach as AddWeightScreen)
      // The system will handle permissions automatically if needed
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // Square aspect ratio for profile photos
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const selectedImage = result.assets[0];
        await uploadProfilePhoto(selectedImage.uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      // If permission error, show helpful message
      if (error.message?.includes('permission') || error.message?.includes('Permission')) {
        Alert.alert(
          'Permission Required',
          'Gallery permission is required. Please enable it in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Open Settings', 
              onPress: () => {
                if (Platform.OS === 'ios') {
                  Linking.openURL('app-settings:');
                } else {
                  Linking.openSettings();
                }
              }
            }
          ]
        );
      } else {
        Alert.alert('Error', `Failed to pick image: ${error.message || 'Please try again.'}`);
      }
    }
  };
  
  const uploadProfilePhoto = async (imageUri) => {
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'User not logged in');
        return;
      }
      
      // Delete old photo if exists
      if (userProfile?.photo_url && !userProfile.photo_url.startsWith('http')) {
        try {
          await supabase.storage
            .from('profile-photos')
            .remove([userProfile.photo_url]);
        } catch (error) {
          console.error('Error deleting old photo:', error);
          // Continue even if deletion fails
        }
      }
      
      // Upload new photo
      // File path format: {user_id}/{timestamp}.jpg to match RLS policy
      const fileName = `${user.id}/${Date.now()}.jpg`;
      
      // Convert image URI to ArrayBuffer for upload
      const response = await fetch(imageUri);
      const arrayBuffer = await response.arrayBuffer();
      
      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(fileName, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: false
        });
      
      if (uploadError) {
        throw uploadError;
      }
      
      // Update user_profile with photo_url
      const { error: updateError } = await supabase
        .from('user_profile')
        .update({ photo_url: fileName })
        .eq('id', user.id);
      
      if (updateError) {
        throw updateError;
      }
      
      // Generate signed URL for immediate display (10 years expiry - effectively never expires)
      // Keep bucket private for security - signed URLs provide access control
      // fileName is already in format: {user_id}/{timestamp}.jpg
      const { data: signedUrlData } = await supabase.storage
        .from('profile-photos')
        .createSignedUrl(fileName, 60 * 60 * 24 * 365 * 10); // 10 years expiry
      
      if (signedUrlData?.signedUrl) {
        setProfilePhotoUrl(signedUrlData.signedUrl);
      }
      
      // Update local state
      setUserProfile(prev => ({ ...prev, photo_url: fileName }));
      
      Alert.alert('Success', 'Profile photo updated successfully!');
    } catch (error) {
      console.error('Error uploading profile photo:', error);
      Alert.alert('Error', `Failed to upload profile photo: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };
  
  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#E8E9F0" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7B61FF" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </View>
    );
  }
  
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="#E8E9F0" />
      
             {/* Header */}
       <View style={styles.header}>
         <TouchableOpacity style={styles.backButton} onPress={() => navigation.navigate('MainDashboard')}>
           <Ionicons name="chevron-back" size={24} color="#333" />
         </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView 
        style={styles.content} 
        contentContainerStyle={{ paddingBottom: insets.bottom >= 20 ? (120 + insets.bottom) : 120 }} 
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Section */}
        <View style={styles.profileSection}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatar}>
              {profilePhotoUrl ? (
                <Image
                  source={{ uri: profilePhotoUrl }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="person" size={60} color="#999" />
              )}
            </View>
            <TouchableOpacity 
              style={styles.cameraButton}
              onPress={handleProfilePhotoPress}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#666" />
              ) : (
                <Ionicons name="camera" size={16} color="#666" />
              )}
            </TouchableOpacity>
          </View>
          
          <Text style={styles.profileName}>{userProfile?.name || 'User'}</Text>
          <Text style={styles.profileStatement}>Your Kalry Statement</Text>
       
        </View>

        {/* Quick Stats */}
        <View style={styles.quickStatsSection}>
          <Text style={styles.sectionTitle}>Quick Stats</Text>
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>7</Text>
              <Text style={styles.statLabel}>Streak</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>25</Text>
              <Text style={styles.statLabel}>Workouts</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>1500</Text>
              <Text style={styles.statLabel}>Kalry Points</Text>
            </View>
          </View>
        </View>

        {/* Settings Menu */}
        <View style={styles.settingsSection}>
          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => navigation.navigate('PersonalInfo')}
          >
            <View style={styles.settingLeft}>
              <Ionicons name="person-outline" size={20} color="#666" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Personal Info</Text>
                <Text style={styles.settingSubtitle}>Name, Email, Birthday</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => navigation.navigate('Preferences')}
          >
            <View style={styles.settingLeft}>
              <Ionicons name="options-outline" size={20} color="#666" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Preferences</Text>
                <Text style={styles.settingSubtitle}>Units, Reminders, Theme</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.settingItem}
            onPress={() => navigation.navigate('AppSettings')}
          >
            <View style={styles.settingLeft}>
              <Ionicons name="settings-outline" size={20} color="#666" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>App Settings</Text>
                <Text style={styles.settingSubtitle}>Notifications, AI Insights, Privacy</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Ionicons name="link-outline" size={20} color="#666" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Connected Devices</Text>
                <Text style={styles.settingSubtitle}>Sync with Apple Health, Google Fit</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingItem}>
            <View style={styles.settingLeft}>
              <Ionicons name="shield-outline" size={20} color="#666" />
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Privacy & Security</Text>
                <Text style={styles.settingSubtitle}>Password, 2FA, Data</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#999" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Updated FooterBar with oval design */}
      <FooterBar navigation={navigation} activeTab="Profile" />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8E9F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: getResponsivePadding(20),
    paddingHorizontal: getResponsivePadding(20),
    paddingBottom: getResponsivePadding(20),
    backgroundColor: '#E8E9F0',
    minHeight: getResponsivePadding(60),
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: getResponsiveFontSize(18),
    fontWeight: '600',
    color: '#333',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: 15,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 15,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  cameraButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  profileName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 5,
  },
  profileStatement: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
  },
  tag: {
    backgroundColor: '#555',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  tagText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  quickStatsSection: {
    marginVertical: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 15,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 15,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 5,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  settingsSection: {
    backgroundColor: 'white',
    borderRadius: 20,
    marginVertical: 10,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingText: {
    marginLeft: 15,
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  settingSubtitle: {
    fontSize: 13,
    color: '#666',
  },
});

// Updated footerStyles for oval design
const footerStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: getResponsivePadding(16),
    right: getResponsivePadding(16),
    backgroundColor: 'transparent',
    alignItems: 'center',
    zIndex: 100,
  },
  ovalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 35,
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: '#7B61FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 16,
    // Add backdrop filter effect for iOS
    ...(Platform.OS === 'ios' && {
      backgroundColor: 'rgba(255, 255, 255, 0.85)',
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    position: 'relative',
  },
  activeTab: {
    // Additional styling for active tab if needed
  },
  label: {
    fontSize: getResponsiveFontSize(12),
    marginTop: getResponsivePadding(4),
    color: '#232B3A',
    letterSpacing: 0.1,
    fontWeight: '500',
  },
  activeLabel: {
    color: '#7B61FF',
    fontWeight: '600',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -12,
    width: 30,
    height: 3,
    backgroundColor: '#7B61FF',
    borderRadius: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E8E9F0',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
});

export default React.memo(ProfileScreen);